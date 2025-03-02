from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import world
from .database import engine, Base

# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="MyCraft Game Server")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Default Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(world.router)

@app.get("/")
def read_root():
    return {"message": "Welcome to MyCraft API"}

@app.get("/api/health")
def health_check():
    return {"status": "ok"} 