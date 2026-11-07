import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export { Simulation } from './engine/simulation.js';
export { scoreDeliverable } from './engine/deliverables.js';
export * as economy from './engine/economy.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

export const loadCompany = (id) => readJson(`data/companies/${id}.json`);
export const loadScenario = (id) => readJson(`data/scenarios/${id}.json`);
