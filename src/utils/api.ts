import axios from 'axios';
import { BlockChange, WorldData } from './types';

const API_URL = 'http://localhost:8000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// World API functions
export const createWorld = async (seed: string): Promise<WorldData> => {
  const response = await api.post('/world', { seed });
  return response.data;
};

export const getWorld = async (worldId: number): Promise<WorldData> => {
  const response = await api.get(`/world/${worldId}`);
  return response.data;
};

export const updateWorldChanges = async (worldId: number, changes: BlockChange[]): Promise<WorldData> => {
  const response = await api.put(`/world/${worldId}/changes`, { changes });
  return response.data;
};

export default api; 