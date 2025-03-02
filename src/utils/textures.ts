import * as THREE from 'three';
import { BlockType } from './types';

// Texture mappings
const TEXTURES: Record<BlockType, string[]> = {
  dirt: ['/resources/blocks/dirt.png'],
  grass: [
    '/resources/blocks/grass_top.png',
    '/resources/blocks/grass_top.png', 
    '/resources/blocks/grass_top.png',
    '/resources/blocks/grass_side.png',
    '/resources/blocks/grass_side.png',
    '/resources/blocks/dirt.png',
  ],
  stone: ['/resources/blocks/stone.png'],
  wood: [
    '/resources/blocks/wood_top.png',
    '/resources/blocks/wood_top.png',
    '/resources/blocks/wood_side.png',
    '/resources/blocks/wood_side.png',
    '/resources/blocks/wood_side.png',
    '/resources/blocks/wood_side.png',
  ],
  leaves: ['/resources/blocks/leaves.png'],
  brick: ['/resources/blocks/brick.png'],
  sand: ['/resources/blocks/sand.png'],
  glass: ['/resources/blocks/glass.png'],
  water: ['/resources/blocks/water.png'],
};

// Create a shared texture loader
const textureLoader = new THREE.TextureLoader();

// Texture and material caches to prevent duplicate loading
const textureCache: Map<string, THREE.Texture> = new Map();
const materialCache: Map<string, THREE.MeshStandardMaterial[]> = new Map();
const geometryCache: Map<string, THREE.BufferGeometry> = new Map();

// Cache for textures used in instanced rendering
const instancedTextureCache: Map<BlockType, THREE.Texture> = new Map();

// Track loading status
let isTextureLoadingComplete = false;
let texturesLoaded = 0;
let totalTexturesToLoad = 0;

// Create a fallback material while textures are loading
const createFallbackMaterial = () => {
  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
    flatShading: true,
    dithering: false
  });
  return Array(6).fill(material);
};

// Get texture for instanced rendering (simplified, using just one texture per block type)
export const getTexture = (type: BlockType): THREE.Texture => {
  if (instancedTextureCache.has(type)) {
    return instancedTextureCache.get(type)!;
  }
  
  // For instanced rendering, just use the first texture for the block type
  const textureUrl = TEXTURES[type][0];
  
  if (textureCache.has(textureUrl)) {
    const texture = textureCache.get(textureUrl)!;
    instancedTextureCache.set(type, texture);
    return texture;
  }
  
  // Create a new texture if not in cache
  const texture = loadTexture(textureUrl);
  instancedTextureCache.set(type, texture);
  return texture;
};

// Get or create a cached block geometry
export const getBlockGeometry = (type: BlockType): THREE.BufferGeometry => {
  if (geometryCache.has(type)) {
    return geometryCache.get(type)!;
  }
  
  // For most blocks, use a simple box geometry
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometryCache.set(type, geometry);
  return geometry;
};

// Load a texture and return it, with error handling
export const loadTexture = (url: string): THREE.Texture => {
  // Check if texture is already cached
  if (textureCache.has(url)) {
    return textureCache.get(url)!;
  }
  
  // Create a temporary placeholder texture
  const placeholder = new THREE.Texture();
  textureCache.set(url, placeholder);
  
  // Load the texture asynchronously
  textureLoader.load(
    url,
    // On success
    (loadedTexture) => {
      loadedTexture.magFilter = THREE.NearestFilter;
      loadedTexture.minFilter = THREE.NearestFilter;
      loadedTexture.generateMipmaps = false;
      
      // Update the placeholder with the loaded texture data
      placeholder.image = loadedTexture.image;
      placeholder.needsUpdate = true;
      
      // Update loading counter
      texturesLoaded++;
      if (texturesLoaded >= totalTexturesToLoad) {
        isTextureLoadingComplete = true;
        console.log('All textures loaded!');
      }
    },
    // On progress
    undefined,
    // On error
    (error) => {
      console.error(`Failed to load texture: ${url}`, error);
      // Create a colored texture as fallback
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#FF00FF'; // Magenta for missing textures
        context.fillRect(0, 0, 16, 16);
      }
      placeholder.image = canvas;
      placeholder.needsUpdate = true;
      
      // Mark as loaded
      texturesLoaded++;
    }
  );
  
  // Return the placeholder that will update when loaded
  return placeholder;
};

// Get materials for a block type
export const getBlockMaterials = (type: BlockType): THREE.MeshStandardMaterial[] => {
  const materialCacheKey = `${type}`;
  
  // If already cached, return from cache
  if (materialCache.has(materialCacheKey)) {
    return materialCache.get(materialCacheKey)!;
  }
  
  // If textures are still loading, return a simple material
  if (!isTextureLoadingComplete) {
    // Use a simple material while textures are loading
    const simpleMaterials = createFallbackMaterial();
    // Don't cache this temporary material
    return simpleMaterials;
  }
  
  const textureUrls = TEXTURES[type];
  
  // If there is only one texture, use it for all sides
  let materials: THREE.MeshStandardMaterial[] = [];
  
  try {
    if (textureUrls.length === 1) {
      const texture = loadTexture(textureUrls[0]);
      const material = new THREE.MeshStandardMaterial({ 
        map: texture,
        transparent: type === 'glass' || type === 'water',
        opacity: type === 'glass' ? 0.8 : type === 'water' ? 0.7 : 1,
        // Performance optimizations
        flatShading: true,
        dithering: false
      });
      materials = Array(6).fill(material);
    } else {
      // Otherwise, use the specific textures for each side
      materials = textureUrls.map(url => {
        const texture = loadTexture(url);
        return new THREE.MeshStandardMaterial({ 
          map: texture,
          transparent: type === 'glass' || type === 'water',
          opacity: type === 'glass' ? 0.8 : type === 'water' ? 0.7 : 1,
          // Performance optimizations
          flatShading: true,
          dithering: false
        });
      });
    }
    
    // Cache the materials
    materialCache.set(materialCacheKey, materials);
    
    return materials;
  } catch (error) {
    console.error(`Error creating materials for ${type}:`, error);
    return createFallbackMaterial();
  }
};

// Dispose textures and materials when no longer needed
export const disposeTextures = (): void => {
  textureCache.forEach(texture => texture.dispose());
  materialCache.forEach(materials => {
    materials.forEach(material => {
      if (material.map) material.map.dispose();
      material.dispose();
    });
  });
  textureCache.clear();
  materialCache.clear();
  
  // Reset loading state
  isTextureLoadingComplete = false;
  texturesLoaded = 0;
  totalTexturesToLoad = 0;
};

// Get all block textures preloaded
export const preloadTextures = (): Promise<void> => {
  return new Promise((resolve) => {
    // Clear any existing textures before preloading
    disposeTextures();
    
    // Count total textures
    const allTextureUrls = new Set<string>();
    Object.values(TEXTURES).forEach(urls => {
      urls.forEach(url => allTextureUrls.add(url));
    });
    
    totalTexturesToLoad = allTextureUrls.size;
    console.log(`Preloading ${totalTexturesToLoad} textures...`);
    
    // Start loading all textures
    allTextureUrls.forEach(url => loadTexture(url));
    
    // Check if textures are loaded
    const checkLoading = () => {
      if (texturesLoaded >= totalTexturesToLoad) {
        isTextureLoadingComplete = true;
        console.log('Texture preloading complete');
        resolve();
      } else {
        console.log(`Texture loading progress: ${texturesLoaded}/${totalTexturesToLoad}`);
        setTimeout(checkLoading, 100);
      }
    };
    
    // Start checking loading status
    checkLoading();
  });
}; 