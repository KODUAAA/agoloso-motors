// Car makes and models for the "Find me a car" form, from the free NHTSA vPIC API
// (https://vpic.nhtsa.dot.gov/api/). Results are cached in memory because the
// catalogue changes rarely and the API can be slow.
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
// Passenger cars, SUVs/vans and pickups. Leaves out motorcycles, buses and trailers.
const VEHICLE_TYPES = ['car', 'multipurpose passenger vehicle (mpv)', 'truck'];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Shown first in the dropdown, and used on their own if the API is unreachable
export const POPULAR_MAKES = [
  'Toyota', 'Honda', 'Hyundai', 'Kia', 'Nissan', 'Ford', 'Chevrolet', 'Mercedes-Benz', 'BMW', 'Audi',
  'Volkswagen', 'Lexus', 'Mazda', 'Mitsubishi', 'Land Rover', 'Jeep', 'Porsche', 'Tesla', 'Subaru', 'Volvo',
];

// vPIC returns names in capitals ("MERCEDES-BENZ"); these stay capitalised when tidied
const ACRONYMS = new Set(['BMW', 'GMC', 'RAM', 'MINI', 'BYD', 'MG', 'SRT', 'AMG']);

const cache = new Map();

async function vpic(path) {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.results;

  const res = await fetch(`${VPIC}${path}${path.includes('?') ? '&' : '?'}format=json`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`vPIC responded ${res.status}`);
  const { Results: results } = await res.json();
  cache.set(path, { results, expires: Date.now() + CACHE_TTL_MS });
  return results;
}

export function tidyName(name) {
  return name
    .trim()
    .split(/(\s+|-)/)
    .map((part) =>
      ACRONYMS.has(part.toUpperCase()) || /^\s+$|^-$/.test(part) || /\d/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    )
    .join('');
}

const unique = (names) => [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// Cars and SUVs only, so heavy-truck builders don't fill the list
const loadMakes = () =>
  Promise.all(VEHICLE_TYPES.slice(0, 2).map((type) => vpic(`/GetMakesForVehicleType/${encodeURIComponent(type)}`)));

// Called at startup so the first customer doesn't wait for the slow first lookup
export function warmCatalogCache() {
  loadMakes().catch(() => {});
}

router.get('/makes', async (req, res) => {
  try {
    const lists = await loadMakes();
    const all = unique(lists.flat().map((m) => tidyName(m.MakeName)));
    const popular = POPULAR_MAKES.filter((make) => all.includes(make));
    res.json({ data: { popular, all }, source: 'nhtsa' });
  } catch {
    // The form still works with the built-in list if NHTSA is down
    res.json({ data: { popular: POPULAR_MAKES, all: [] }, source: 'fallback' });
  }
});

router.get(
  '/models',
  validate({
    query: z.object({
      make: z.string().trim().min(1).max(60).regex(/^[\p{L}\p{N} .&'-]+$/u, 'Choose a make from the list'),
      year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
    }),
  }),
  async (req, res) => {
    const { make, year } = req.valid.query;
    // Filtering by vehicle type keeps motorcycles out (BMW and Honda make both)
    const base = `/GetModelsForMakeYear/make/${encodeURIComponent(make)}${year ? `/modelyear/${year}` : ''}`;
    // Some makes have no models in a category (BMW builds no pickups), and vPIC answers
    // those with an error, so only give up if every lookup fails
    const results = await Promise.allSettled(
      VEHICLE_TYPES.map((type) => vpic(`${base}/vehicletype/${encodeURIComponent(type)}`)),
    );
    const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!lists.length) throw new HttpError(503, 'The model list is unavailable right now. Type the model instead.');
    res.json({ data: unique(lists.flat().map((m) => m.Model_Name)) });
  },
);

export default router;
