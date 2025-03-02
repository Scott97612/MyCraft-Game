import { useState, useEffect } from 'react';
import { BlockType } from '../../utils/types';
import './Hotbar.css';

interface HotbarProps {
  onSelectBlock: (blockType: BlockType) => void;
}

const Hotbar: React.FC<HotbarProps> = ({ onSelectBlock }) => {
  const [selectedSlot, setSelectedSlot] = useState(0);
  
  // Available block types
  const blockTypes: BlockType[] = [
    'dirt',
    'grass',
    'stone',
    'wood',
    'leaves',
    'brick',
    'sand',
    'glass',
    'water'
  ];
  
  // Handle keyboard input for slot selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Number keys 1-9
      if (e.key >= '1' && e.key <= '9') {
        const slot = parseInt(e.key) - 1;
        if (slot < blockTypes.length) {
          setSelectedSlot(slot);
          onSelectBlock(blockTypes[slot]);
        }
      }
      
      // Mouse wheel (not implemented here, would need additional event listeners)
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [blockTypes, onSelectBlock]);
  
  // Set initial selected block
  useEffect(() => {
    onSelectBlock(blockTypes[selectedSlot]);
  }, []);
  
  return (
    <div className="hotbar">
      {blockTypes.map((blockType, index) => (
        <div 
          key={blockType}
          className={`hotbar-slot ${index === selectedSlot ? 'selected' : ''}`}
          onClick={() => {
            setSelectedSlot(index);
            onSelectBlock(blockType);
          }}
        >
          <img 
            src={`/resources/icons/${blockType === 'grass' ? 'grass' : blockType}.png`} 
            alt={blockType} 
          />
        </div>
      ))}
    </div>
  );
};

export default Hotbar; 