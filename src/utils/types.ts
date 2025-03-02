export type BlockType = 
  | 'dirt'
  | 'grass'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'brick'
  | 'sand'
  | 'glass'
  | 'water';

export interface BlockPosition {
  x: number;
  y: number;
  z: number;
}

export interface Block extends BlockPosition {
  type: BlockType;
}

export interface BlockChange extends Block {
  action: 'place' | 'remove';
}

export interface ChunkData {
  position: {
    x: number;
    y: number;
    z: number;
  };
  blocks: Block[];
}

export interface WorldData {
  id: number;
  seed: string;
  changes: BlockChange[];
  last_updated: string;
}

export interface PlayerState {
  position: [number, number, number];
  rotation: [number, number, number];
  selectedBlock: BlockType;
} 