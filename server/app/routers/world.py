from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import json

from .. import schemas, database
from ..models.world import World

router = APIRouter(
    prefix="/api/world",
    tags=["world"],
)

# Get the database session
get_db = database.get_db

@router.post("/", response_model=schemas.World)
def create_world(world_data: schemas.WorldCreate, db: Session = Depends(get_db)):
    """Create a new world with a seed for terrain generation"""
    new_world = World(
        seed=world_data.seed,
        changes=json.dumps([]),
        last_updated=datetime.now()
    )
    db.add(new_world)
    db.commit()
    db.refresh(new_world)
    
    # Parse the JSON string into a list before returning
    world_dict = new_world.__dict__.copy()
    world_dict["changes"] = json.loads(world_dict["changes"]) if world_dict["changes"] else []
    return world_dict

@router.get("/{world_id}", response_model=schemas.World)
def get_world(world_id: int, db: Session = Depends(get_db)):
    """Get a world by ID"""
    db_world = db.query(World).filter(World.id == world_id).first()
    if db_world is None:
        raise HTTPException(status_code=404, detail="World not found")
    
    # Parse the JSON string into a list before returning
    world_dict = db_world.__dict__.copy()
    world_dict["changes"] = json.loads(world_dict["changes"]) if world_dict["changes"] else []
    return world_dict

@router.put("/{world_id}/changes", response_model=schemas.World)
def update_world_changes(world_id: int, changes: schemas.WorldUpdate, db: Session = Depends(get_db)):
    """Update the block changes in a world"""
    db_world = db.query(World).filter(World.id == world_id).first()
    if db_world is None:
        raise HTTPException(status_code=404, detail="World not found")
    
    # Parse existing changes as JSON
    existing_changes = json.loads(db_world.changes) if db_world.changes else []
    
    # Append new changes
    new_changes = [change.dict() for change in changes.changes]
    updated_changes = existing_changes + new_changes
    
    # Update the world
    db_world.changes = json.dumps(updated_changes)
    db_world.last_updated = datetime.now()
    
    db.commit()
    db.refresh(db_world)
    
    # Parse the JSON string into a list before returning
    world_dict = db_world.__dict__.copy()
    world_dict["changes"] = json.loads(world_dict["changes"]) if world_dict["changes"] else []
    return world_dict 