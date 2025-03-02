# MyCraft - A Minecraft-like Game in the Browser

A voxel-based game similar to Minecraft, built with React, Three.js, and FastAPI.

## Features

- 3D voxel-based world with procedural terrain generation
- Player movement with WASD keys and mouse look
- Block placement and removal
- Different block types with appropriate textures
- World persistence using a FastAPI backend

## Prerequisites

- Node.js (v14+)
- Python (v3.8+)
- npm or yarn

## Setup and Running

### Backend (FastAPI)

1. Navigate to the server directory:
   ```
   cd server
   ```

2. Create a virtual environment (optional but recommended):
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Run the server:
   ```
   python run.py
   ```

The server will start at http://localhost:8000.

### Frontend (React)

1. In a new terminal, navigate to the project root directory.

2. Install dependencies:
   ```
   npm install
   ```

3. Run the development server:
   ```
   npm run dev
   ```

The frontend will start at http://localhost:5173.

## How to Play

- **Movement**: WASD keys to move, Space to jump
- **Camera**: Move the mouse to look around
- **Interaction**: Left-click to break blocks, right-click to place blocks
- **Block Selection**: Use number keys 1-9 to select different block types
- **Mouse Lock**: Click on the game to lock the mouse, press ESC to unlock

## Project Structure

- `/server`: FastAPI backend for world persistence
  - `/app`: Main application code
    - `/models`: Database models
    - `/routers`: API endpoints
- `/src`: React frontend
  - `/components`: React components
    - `/game`: Game-related components
    - `/ui`: User interface components
  - `/utils`: Utility functions and types
  - `/hooks`: Custom React hooks

## License

MIT
