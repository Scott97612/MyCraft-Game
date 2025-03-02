import { useState, useEffect, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Sky, Stats } from '@react-three/drei';
import { createWorld, getWorld } from '../../utils/api';
import { BlockType, PlayerState, WorldData } from '../../utils/types';
import { preloadTextures } from '../../utils/textures';
import World from './World';
import Player from './Player';
import Hotbar from '../ui/Hotbar';
import Crosshair from '../ui/Crosshair';
import './Game.css';

const Game: React.FC = () => {
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>({
    position: [0, 20, 0],
    rotation: [0, 0, 0],
    selectedBlock: 'dirt'
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true); // Default to showing stats for debugging
  
  // Store update times for throttling
  const lastPositionUpdate = useRef<number>(0);
  const frameCount = useRef<number>(0);
  const performanceMonitor = useRef<{
    lastCheck: number;
    lowPerformanceCount: number;
    isLowPerformance: boolean;
  }>({
    lastCheck: 0,
    lowPerformanceCount: 0,
    isLowPerformance: false
  });
  
  // Monitor performance and detect potential issues
  useEffect(() => {
    const interval = setInterval(() => {
      const now = performance.now();
      
      // Calculate FPS
      const elapsed = now - performanceMonitor.current.lastCheck;
      const fps = frameCount.current / (elapsed / 1000);
      
      console.log(`[DEBUG] Game Performance: FPS: ${fps.toFixed(1)}, Frame count: ${frameCount.current}`);
      
      // Reset counters
      frameCount.current = 0;
      performanceMonitor.current.lastCheck = now;
      
      // Detect low performance
      if (fps < 20) {
        performanceMonitor.current.lowPerformanceCount++;
        console.warn(`[DEBUG] Low performance detected: ${fps.toFixed(1)} FPS`);
        
        if (performanceMonitor.current.lowPerformanceCount > 5 && !performanceMonitor.current.isLowPerformance) {
          console.error("[DEBUG] Consistent low performance detected, enabling low performance mode");
          performanceMonitor.current.isLowPerformance = true;
          // You could add code here to scale down quality settings
        }
      } else {
        performanceMonitor.current.lowPerformanceCount = 0;
      }
    }, 1000);
    
    performanceMonitor.current.lastCheck = performance.now();
    
    return () => clearInterval(interval);
  }, []);
  
  // Initialize the game
  useEffect(() => {
    const initGame = async () => {
      try {
        setLoading(true);
        console.log("[INIT] Initializing game...");
        
        // Preload textures
        console.log("[INIT] Preloading textures...");
        try {
          await preloadTextures();
          console.log("[INIT] Textures loaded successfully");
        } catch (textureError) {
          console.error("[INIT] Texture loading error:", textureError);
          // Continue anyway, we'll use fallback textures
        }
        
        // Check if we have a world ID in localStorage
        const storedWorldId = localStorage.getItem('worldId');
        let world: WorldData;
        
        if (storedWorldId) {
          // Load existing world
          console.log(`[INIT] Loading world with ID: ${storedWorldId}`);
          try {
            world = await getWorld(parseInt(storedWorldId));
            console.log("[INIT] Existing world loaded successfully");
          } catch (worldError) {
            console.error("[INIT] Failed to load existing world:", worldError);
            // If we can't load the stored world, create a new one
            const seed = Math.random().toString(36).substring(2, 15);
            console.log(`[INIT] Creating new world with seed: ${seed}`);
            world = await createWorld(seed);
            localStorage.setItem('worldId', world.id.toString());
          }
        } else {
          // Create a new world with a random seed
          const seed = Math.random().toString(36).substring(2, 15);
          console.log(`[INIT] Creating new world with seed: ${seed}`);
          world = await createWorld(seed);
          localStorage.setItem('worldId', world.id.toString());
        }
        
        console.log("[INIT] World data loaded:", world);
        setWorldData(world);
        setLoading(false);
      } catch (error) {
        console.error('[INIT] Failed to initialize game:', error);
        setError('Failed to load the game. Please try again.');
        setLoading(false);
      }
    };
    
    // Add a delay to allow components to mount properly
    const initTimer = setTimeout(() => {
      console.log("[INIT] Starting game initialization...");
      initGame();
    }, 500);
    
    // Add key listener for toggling stats
    const handleKeyPress = (e: KeyboardEvent) => {
      console.log(`Key pressed: ${e.key}`);
      
      if (e.key === 'F3') {
        setShowStats(prev => !prev);
      } else if (e.key === 'Escape') {
        document.exitPointerLock();
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    
    return () => {
      clearTimeout(initTimer);
      window.removeEventListener('keydown', handleKeyPress);
    };
  }, []);
  
  // Handle player movement with throttling
  const handlePlayerMove = (position: [number, number, number]) => {
    // Only update state when needed
    const now = performance.now();
    if (now - lastPositionUpdate.current > 100) { // Throttle to 10 updates per second
      setPlayerState(prev => ({
        ...prev,
        position
      }));
      lastPositionUpdate.current = now;
    }
  };
  
  // Handle player rotation with efficient updates
  const handlePlayerRotate = (rotation: [number, number, number]) => {
    // No need to store every rotation update in state
    // It's only used for UI, so we update the player component directly
  };
  
  // Handle block selection
  const handleSelectBlock = (blockType: BlockType) => {
    setPlayerState(prev => ({
      ...prev,
      selectedBlock: blockType
    }));
  };
  
  // Add a render counter to detect excessive re-renders
  const renderCount = useRef(0);
  console.log(`[DEBUG] Game component render #${++renderCount.current}`);
  
  // Count frames for performance monitoring with more detailed logging
  const handleFrameLoop = () => {
    frameCount.current++;
    
    // Log every 1000 frames to identify potential loop issues
    if (frameCount.current % 1000 === 0) {
      console.log(`[DEBUG] Game frame count: ${frameCount.current}, player position: ${playerState.position}`);
    }
  };
  
  // Show loading screen
  if (loading) {
    return (
      <div className="loading-screen">
        <h1>Loading MyCraft...</h1>
        <div className="loading-spinner"></div>
      </div>
    );
  }
  
  // Show error screen
  if (error) {
    return (
      <div className="error-screen">
        <h1>Error</h1>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Try Again</button>
      </div>
    );
  }
  
  // Low performance mode settings
  const qualitySettings = performanceMonitor.current.isLowPerformance
    ? {
        shadows: false,
        gl: { 
          antialias: false,
          powerPreference: 'high-performance',
          depth: true,
          stencil: false,
          alpha: false,
        },
        camera: { fov: 75, near: 0.1, far: 100 },
        performance: { min: 0.5, max: 1 },
      }
    : {
        shadows: true,
        gl: { 
          antialias: false,
          powerPreference: 'high-performance',
          depth: true,
          stencil: false,
          alpha: false,
        },
        camera: { fov: 75, near: 0.1, far: 1000 },
        performance: { min: 0.5 },
      };
  
  // Show game
  return (
    <div className="game-container">
      <Canvas 
        onCreated={() => console.log("Canvas created")}
        frameloop="always"  // Always render frames for better control
        onBeforeRender={handleFrameLoop}
        {...qualitySettings}
      >
        <Suspense fallback={null}>
          {/* Performance stats (toggle with F3) */}
          {showStats && <Stats />}
          
          {/* Sky */}
          <Sky sunPosition={[100, 100, 20]} />
          
          {/* Fog */}
          <fog attach="fog" args={['#c9e6ff', 15, 80]} />
          
          {/* Player */}
          <Player 
            onPlayerMove={handlePlayerMove} 
            onPlayerRotate={handlePlayerRotate} 
          />
          
          {/* World */}
          {worldData && (
            <World 
              worldId={worldData.id}
              seed={worldData.seed}
              initialChanges={worldData.changes}
              selectedBlock={playerState.selectedBlock}
            />
          )}
        </Suspense>
      </Canvas>
      
      {/* UI Elements */}
      <Crosshair />
      <Hotbar onSelectBlock={handleSelectBlock} />
      
      {/* Instructions */}
      <div className="instructions">
        <p>WASD to move, SPACE to jump</p>
        <p>Left click to break blocks, right click to place blocks</p>
        <p>1-9 keys to select blocks</p>
        <p>Click to lock mouse, ESC to unlock</p>
        <p>Press F3 to toggle performance stats</p>
      </div>
      
      {/* Performance warning */}
      {performanceMonitor.current.isLowPerformance && (
        <div className="performance-warning">
          Low performance detected. Quality settings have been reduced.
        </div>
      )}
    </div>
  );
};

export default Game; 