// Creates the first admin account (from ADMIN_* in .env) and, if the inventory is empty,
// a set of sample vehicles. Safe to run more than once.
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, query } from './index.js';

// Photos were checked by eye to make sure each one shows the car it is listed against.
// They are served from public/media/photos so the site does not depend on another website.

export const sampleVehicles = [
  {
    make: 'BMW', model: 'M5 Competition', year: 2019, price: 64900, mileage: 38200,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'sedan', color: 'Alpine White', engine: '4.4L Twin-Turbo V8',
    description: 'Competition package with carbon ceramic brakes, bronze forged wheels, Bowers & Wilkins audio and full BMW service history.',
    images: ['/media/photos/bmw-m5-competition.webp'], featured: true,
  },
  {
    make: 'Porsche', model: '911 Turbo S', year: 2021, price: 189500, mileage: 12900,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'coupe', color: 'GT Silver Metallic', engine: '3.8L Twin-Turbo Flat-Six',
    description: 'Sport Chrono, sports exhaust, front axle lift and ceramic brakes. Garaged and covered, never tracked.',
    images: ['/media/photos/porsche-911-turbo-s.webp'], featured: true,
  },
  {
    make: 'Tesla', model: 'Model 3 Long Range', year: 2022, price: 38900, mileage: 31000,
    fuel_type: 'electric', transmission: 'automatic', body_type: 'sedan', color: 'Pearl White', engine: 'Dual Motor AWD',
    description: 'Long-range battery, Autopilot, glass roof and premium interior. Battery health report available.',
    images: ['/media/photos/tesla-model-3.webp'], featured: true,
  },
  {
    make: 'Toyota', model: 'Tacoma TRD Off-Road', year: 2019, price: 36400, mileage: 54800,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'pickup', color: 'Quicksand', engine: '3.5L V6',
    description: 'Double cab with a 2-inch lift, all-terrain tyres, aftermarket wheels and LED light bar. Locking rear differential.',
    images: ['/media/photos/toyota-tacoma.webp'],
  },
  {
    make: 'Mercedes-AMG', model: 'GT R', year: 2020, price: 142000, mileage: 9600,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'coupe', color: 'Selenite Grey Magno', engine: '4.0L Twin-Turbo V8',
    description: 'Track-bred coupe with rear-wheel steering, adjustable coilovers and AMG Performance seats.',
    images: ['/media/photos/mercedes-amg-gt-r.webp'],
  },
  {
    make: 'Nissan', model: 'Altima 2.5 SR', year: 2018, price: 14250, mileage: 71300,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'sedan', color: 'Storm Blue', engine: '2.5L 4-cylinder',
    description: 'Comfortable, economical commuter with sport-tuned suspension, remote start and a reversing camera.',
    images: ['/media/photos/nissan-altima.webp'],
  },
  {
    make: 'Ford', model: 'Explorer Police Interceptor Utility', year: 2018, price: 17900, mileage: 98400,
    fuel_type: 'petrol', transmission: 'automatic', body_type: 'suv', color: 'Oxford White', engine: '3.7L V6 AWD',
    description: 'Former fleet vehicle, decommissioned and fully serviced. Heavy-duty brakes and cooling, all-wheel drive, steel wheels.',
    images: ['/media/photos/ford-explorer.webp'],
  },
  {
    make: 'Toyota', model: 'Land Cruiser Prado', year: 2022, price: 58500, mileage: 21400,
    fuel_type: 'diesel', transmission: 'automatic', body_type: 'suv', color: 'Pearl White', engine: '2.8L Turbo Diesel',
    description: 'One owner, full dealer service history. Seven seats, leather interior, 360° camera and adaptive cruise control.',
    status: 'reserved',
  },
];

async function seedAdmin(log) {
  const { ADMIN_NAME = 'Admin', ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log('Skipping admin account: set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create one.');
    return;
  }
  if (ADMIN_PASSWORD.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');

  const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [ADMIN_EMAIL]);
  if (existing.rowCount) {
    log(`Admin account ${ADMIN_EMAIL} already exists.`);
    return;
  }
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`, [
    ADMIN_NAME,
    ADMIN_EMAIL,
    hash,
  ]);
  log(`Created admin account ${ADMIN_EMAIL}.`);
}

async function seedVehicles(log) {
  const { rows } = await query('SELECT count(*)::int AS count FROM vehicles');
  if (rows[0].count > 0) {
    log('Vehicles already exist; skipping sample inventory.');
    return;
  }
  for (const v of sampleVehicles) {
    await query(
      `INSERT INTO vehicles (make, model, year, price, mileage, fuel_type, transmission, body_type,
                             color, engine, description, images, status, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [v.make, v.model, v.year, v.price, v.mileage, v.fuel_type, v.transmission, v.body_type,
        v.color, v.engine, v.description, v.images ?? [], v.status ?? 'available', v.featured ?? false],
    );
  }
  log(`Added ${sampleVehicles.length} sample vehicles.`);
}

export async function seed({ log = console.log } = {}) {
  await seedAdmin(log);
  await seedVehicles(log);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err.message || err.code || err);
      await pool.end();
      process.exit(1);
    });
}
