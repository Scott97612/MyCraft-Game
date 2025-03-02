from sqlalchemy import Column, Integer, String, JSON
from sqlalchemy.sql.sqltypes import TIMESTAMP
from ..database import Base

class World(Base):
    __tablename__ = "worlds"

    id = Column(Integer, primary_key=True, index=True)
    seed = Column(String, nullable=False)
    # Store block changes as a JSON array
    changes = Column(JSON, nullable=False, default=list)
    last_updated = Column(TIMESTAMP, nullable=False) 