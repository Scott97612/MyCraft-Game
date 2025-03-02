from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

# Schema for a block change (position and block type)
class BlockChange(BaseModel):
    x: int
    y: int
    z: int
    type: str  # Block type (e.g., "dirt", "stone", etc.)
    action: str  # "place" or "remove"

# Schema for creating a world
class WorldCreate(BaseModel):
    seed: str
    
# Schema for a world in the database
class World(WorldCreate):
    id: int
    changes: List[Dict[str, Any]] = []
    last_updated: datetime
    
    class Config:
        from_attributes = True

# Schema for updating world changes
class WorldUpdate(BaseModel):
    changes: List[BlockChange] 