import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { BlockType } from '../../utils/types';
import { getBlockMaterials } from '../../utils/textures';

interface BlockProps {
  position: [number, number, number];
  type: BlockType;
  onClick?: (e: any) => void;
  onContextMenu?: (e: any) => void;
}

const Block: React.FC<BlockProps> = ({ position, type, onClick, onContextMenu }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Get materials for the block type
  const materials = useMemo(() => getBlockMaterials(type), [type]);

  // For water animation, use a shared clock
  const [lastAnimTime, setLastAnimTime] = useState(0);
  
  // Special animation for water, throttled to reduce updates
  useFrame(({ clock }) => {
    if (type === 'water' && meshRef.current) {
      const currentTime = clock.getElapsedTime();
      // Only update animation every 200ms (5 fps) instead of every frame
      if (currentTime - lastAnimTime > 0.2) {
        meshRef.current.position.y = position[1] + Math.sin(currentTime * 2) * 0.05;
        setLastAnimTime(currentTime);
      }
    }
  });
  
  // Optimize mesh rendering based on distance from camera
  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={onClick}
      onContextMenu={onContextMenu}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      {materials.map((material, index) => (
        <meshStandardMaterial key={index} attach={`material-${index}`} {...material} />
      ))}
    </mesh>
  );
};

export default Block; 