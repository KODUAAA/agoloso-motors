// End-to-end API tests against a real Postgres database.
// They wipe the tables they use, so point TEST_DATABASE_URL at a throwaway database:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/agoloso_test npm test
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

const TEST_DB = process.env.TEST_DATABASE_URL;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DB ?? 'postgres://unused';
process.env.DATABASE_SSL = 'false';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-password-123';
process.env.DEFAULT_APR = '10';

describe('Agoloso Motors API', { skip: !TEST_DB && 'set TEST_DATABASE_URL to run the API tests' }, () => {
  let server;
  let base;
  let pool;
  let adminToken;

  async function call(path, { method = 'GET', body, token } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json();
    return { status: res.status, data };
  }

  before(async () => {
    ({ pool } = await import('../src/db/index.js'));
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    const { migrate } = await import('../src/db/migrate.js');
    const { seed } = await import('../src/db/seed.js');
    await migrate({ log: () => {} });
    await seed({ log: () => {} });
    const { createApp } = await import('../src/app.js');
    server = createApp().listen(0);
    base = `http://localhost:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    await pool?.end();
  });

  test('health check reports the database', async () => {
    const { status, data } = await call('/health');
    assert.equal(status, 200);
    assert.equal(data.database, 'connected');
  });

  describe('auth', () => {
    test('rejects a wrong password without saying which part was wrong', async () => {
      const { status, data } = await call('/auth/login', { method: 'POST', body: { email: 'admin@test.local', password: 'nope' } });
      assert.equal(status, 401);
      assert.equal(data.error, 'Incorrect email or password.');
    });

    test('logs in with the seeded admin (email is case-insensitive)', async () => {
      const { status, data } = await call('/auth/login', { method: 'POST', body: { email: 'Admin@Test.local', password: 'admin-password-123' } });
      assert.equal(status, 200);
      assert.equal(data.user.role, 'admin');
      assert.equal(data.user.password_hash, undefined);
      adminToken = data.token;
    });

    test('protected routes need a valid token', async () => {
      assert.equal((await call('/leads')).status, 401);
      assert.equal((await call('/leads', { token: 'garbage' })).status, 401);
      assert.equal((await call('/leads', { token: adminToken })).status, 200);
    });

    test('staff cannot manage users or delete records', async () => {
      const created = await call('/auth/users', {
        method: 'POST',
        token: adminToken,
        body: { name: 'Sam Staff', email: 'sam@test.local', password: 'staff-password-1', role: 'staff' },
      });
      assert.equal(created.status, 201);
      const login = await call('/auth/login', { method: 'POST', body: { email: 'sam@test.local', password: 'staff-password-1' } });
      const staff = login.data.token;
      assert.equal((await call('/auth/users', { token: staff })).status, 403);
      assert.equal((await call('/vehicles/1', { method: 'DELETE', token: staff })).status, 403);
      // ...but can edit inventory
      assert.equal((await call('/vehicles/1', { method: 'PATCH', token: staff, body: { mileage: 38300 } })).status, 200);
    });

    test('duplicate staff emails are rejected', async () => {
      const { status } = await call('/auth/users', {
        method: 'POST',
        token: adminToken,
        body: { name: 'Sam Again', email: 'SAM@test.local', password: 'staff-password-1' },
      });
      assert.equal(status, 409);
    });
  });

  describe('vehicles', () => {
    test('public listing hides sold cars; staff can see them', async () => {
      await call('/vehicles/2', { method: 'PATCH', token: adminToken, body: { status: 'sold' } });
      const publicList = await call('/vehicles?limit=50');
      assert.ok(publicList.data.data.every((v) => v.status !== 'sold'));
      const asksForSold = await call('/vehicles?status=sold');
      assert.ok(asksForSold.data.data.every((v) => v.status !== 'sold'));
      const staffList = await call('/vehicles?status=sold', { token: adminToken });
      assert.equal(staffList.data.data.length, 1);
    });

    test('filters, sorting and pagination', async () => {
      const { data } = await call('/vehicles?fuel_type=petrol&sort=price_asc&limit=2&page=1');
      assert.equal(data.limit, 2);
      assert.ok(data.total >= 2);
      assert.ok(data.data.every((v) => v.fuel_type === 'petrol'));
      assert.ok(data.data[0].price <= data.data[1].price);

      const search = await call('/vehicles?q=tacoma');
      assert.equal(search.data.total, 1);
      // LIKE wildcards in the search box are treated as plain text
      assert.equal((await call('/vehicles?q=%25')).data.total, 0);
      // Empty filters from HTML forms are ignored
      assert.equal((await call('/vehicles?make=&max_price=')).status, 200);
    });

    test('rejects invalid filters and bodies with field-level errors', async () => {
      const bad = await call('/vehicles?body_type=spaceship');
      assert.equal(bad.status, 400);
      assert.equal(bad.data.details[0].field, 'body_type');

      const create = await call('/vehicles', { method: 'POST', token: adminToken, body: { make: 'X', year: 1800, images: ['javascript:alert(1)'] } });
      assert.equal(create.status, 400);
      const fields = create.data.details.map((d) => d.field);
      assert.ok(fields.includes('year'));
      assert.ok(fields.includes('images.0'));
    });

    test('creates, partially updates and deletes a car', async () => {
      const created = await call('/vehicles', {
        method: 'POST',
        token: adminToken,
        body: { make: 'Kia', model: 'Sportage', year: 2023, price: 27500, fuel_type: 'hybrid', transmission: 'automatic', body_type: 'suv' },
      });
      assert.equal(created.status, 201);
      assert.equal(created.data.data.status, 'available');
      const id = created.data.data.id;

      const patched = await call(`/vehicles/${id}`, { method: 'PATCH', token: adminToken, body: { price: 26900 } });
      assert.equal(patched.data.data.price, 26900);
      assert.equal(patched.data.data.make, 'Kia', 'fields not sent are left alone');

      // Photos stored on the site itself are accepted; other relative paths are not
      const local = await call(`/vehicles/${id}`, { method: 'PATCH', token: adminToken, body: { images: ['/media/photos/kia.webp'] } });
      assert.equal(local.status, 200);
      const sneaky = await call(`/vehicles/${id}`, { method: 'PATCH', token: adminToken, body: { images: ['/../../etc/passwd', '//evil.com/x.jpg'] } });
      assert.equal(sneaky.status, 400);

      assert.equal((await call(`/vehicles/${id}`, { method: 'DELETE', token: adminToken })).status, 204);
      assert.equal((await call(`/vehicles/${id}`)).status, 404);
    });

    test('lists makes for the search dropdown', async () => {
      const { data } = await call('/vehicles/makes');
      assert.ok(data.data.some((m) => m.make === 'Tesla'));
    });
  });

  describe('leads', () => {
    test('accepts a test drive booking and validates it', async () => {
      const missing = await call('/leads', { method: 'POST', body: { type: 'test_drive', name: 'Ama', email: 'ama@example.com', vehicle_id: 1 } });
      assert.equal(missing.status, 400);
      assert.deepEqual(missing.data.details.map((d) => d.field).sort(), ['phone', 'preferred_date']);
      assert.ok(missing.data.details.every((d) => d.message === 'This field is required'));

      // An empty form reports every missing field at once, in plain language
      const empty = await call('/leads', { method: 'POST', body: { type: 'test_drive' } });
      assert.deepEqual(empty.data.details.map((d) => d.field).sort(), ['email', 'name', 'phone', 'preferred_date', 'vehicle_id']);
      const badEmail = await call('/leads', { method: 'POST', body: { type: 'contact', name: 'A', email: 'nope', message: 'hi' } });
      assert.equal(badEmail.data.details[0].message, 'Enter a valid email address');

      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const ok = await call('/leads', {
        method: 'POST',
        body: { type: 'test_drive', name: 'Ama', email: 'AMA@example.com', phone: '+233 24 123 4567', vehicle_id: 1, preferred_date: tomorrow },
      });
      assert.equal(ok.status, 201);
    });

    test('refuses enquiries about sold cars', async () => {
      const { status } = await call('/leads', { method: 'POST', body: { type: 'enquiry', name: 'Kofi', email: 'kofi@example.com', vehicle_id: 2 } });
      assert.equal(status, 400);
    });

    test('silently drops spam caught by the honeypot', async () => {
      const before = (await call('/leads', { token: adminToken })).data.total;
      const res = await call('/leads', { method: 'POST', body: { type: 'contact', name: 'Bot', email: 'bot@example.com', message: 'buy now', website: 'http://spam' } });
      assert.equal(res.status, 201);
      assert.equal((await call('/leads', { token: adminToken })).data.total, before);
    });

    test('staff can update status and notes', async () => {
      const { data } = await call('/leads?type=test_drive', { token: adminToken });
      const lead = data.data[0];
      assert.equal(lead.email, 'ama@example.com');
      assert.match(lead.vehicle_title, /BMW/);
      const updated = await call(`/leads/${lead.id}`, { method: 'PATCH', token: adminToken, body: { status: 'contacted', notes: 'Called, confirmed 10am' } });
      assert.equal(updated.data.data.status, 'contacted');
      assert.equal(updated.data.data.notes, 'Called, confirmed 10am');
      // Changing only the status keeps the notes
      const again = await call(`/leads/${lead.id}`, { method: 'PATCH', token: adminToken, body: { status: 'qualified' } });
      assert.equal(again.data.data.notes, 'Called, confirmed 10am');
    });
  });

  describe('finance', () => {
    test('quote uses the standard repayment formula', async () => {
      const { data } = await call('/finance/quote?price=20000&deposit=2000&term_months=48&apr=10');
      assert.equal(data.data.principal, 18000);
      assert.equal(data.data.monthlyPayment, 456.53);
    });

    test('an application uses the listed price and the dealership rate, not the browser\'s', async () => {
      const { status, data } = await call('/finance/applications', {
        method: 'POST',
        body: {
          vehicle_id: 3, vehicle_price: 1, deposit: 3900, term_months: 60,
          name: 'Efua', email: 'efua@example.com', phone: '0241234567',
          employment_status: 'employed', monthly_income: 4500, consent: true,
        },
      });
      assert.equal(status, 201);
      assert.equal(data.data.vehicle_price, 38900);
      assert.equal(data.data.apr, 10);
      assert.ok(data.data.monthly_payment > 700 && data.data.monthly_payment < 800);
    });

    test('requires consent and a deposit below the price', async () => {
      const { status, data } = await call('/finance/applications', {
        method: 'POST',
        body: { vehicle_id: 3, deposit: 50000, term_months: 60, name: 'E', email: 'e@example.com', phone: '0241234567', employment_status: 'employed', monthly_income: 1 },
      });
      assert.equal(status, 400);
      assert.ok(data.details.some((d) => d.field === 'consent'));
      const deposit = await call('/finance/applications', {
        method: 'POST',
        body: { vehicle_id: 3, deposit: 50000, term_months: 60, name: 'E', email: 'e@example.com', phone: '0241234567', employment_status: 'employed', monthly_income: 1, consent: true },
      });
      assert.equal(deposit.data.details[0].field, 'deposit');
    });
  });

  describe('sourcing requests (find me a car)', () => {
    const request = {
      make: 'BMW', model: 'X5', year_min: 2019, year_max: 2022, trim: 'M Sport', color: 'Black',
      max_mileage: 60000, budget: 45000, timeframe: 'within_1_month',
      name: 'Yaw', email: 'Yaw@Example.com', phone: '+233 20 555 0101', message: 'Need 7 seats',
    };
    let requestId;

    test('a customer can submit a request', async () => {
      const { status, data } = await call('/sourcing', { method: 'POST', body: request });
      assert.equal(status, 201);
      assert.equal(data.data.status, 'new');
      requestId = data.data.id;
    });

    test('reports every missing field at once', async () => {
      const { status, data } = await call('/sourcing', { method: 'POST', body: {} });
      assert.equal(status, 400);
      assert.deepEqual(
        data.details.map((d) => d.field).sort(),
        ['budget', 'email', 'make', 'model', 'name', 'phone', 'timeframe'],
      );
    });

    test('rejects a year range that runs backwards', async () => {
      const { status, data } = await call('/sourcing', { method: 'POST', body: { ...request, year_min: 2023, year_max: 2019 } });
      assert.equal(status, 400);
      assert.equal(data.details[0].field, 'year_max');
    });

    test('only staff can see requests', async () => {
      assert.equal((await call('/sourcing')).status, 401);
      const { data } = await call('/sourcing?status=open', { token: adminToken });
      assert.equal(data.total, 1);
      assert.equal(data.data[0].email, 'yaw@example.com');
      assert.equal(data.data[0].max_mileage, 60000);
    });

    test('staff move a request through the stages', async () => {
      const quoted = await call(`/sourcing/${requestId}`, { method: 'PATCH', token: adminToken, body: { quote_amount: 43800, status: 'quote_sent' } });
      assert.equal(quoted.data.data.quote_amount, 43800);
      assert.equal(quoted.data.data.status, 'quote_sent');

      const delivered = await call(`/sourcing/${requestId}`, { method: 'PATCH', token: adminToken, body: { status: 'delivered', notes: 'Handed over' } });
      assert.equal(delivered.data.data.notes, 'Handed over');
      assert.equal(delivered.data.data.quote_amount, 43800, 'fields not sent are left alone');

      // Delivered requests drop out of the "still in progress" list
      assert.equal((await call('/sourcing?status=open', { token: adminToken })).data.total, 0);
      assert.equal((await call('/sourcing?status=bogus', { token: adminToken })).status, 400);
    });

    test('the model lookup rejects odd make names before calling NHTSA', async () => {
      const { status } = await call('/catalog/models?make=%3Cscript%3E');
      assert.equal(status, 400);
    });
  });

  test('dashboard stats add up', async () => {
    const { data } = await call('/stats', { token: adminToken });
    assert.equal(data.data.inventory.sold, 1);
    assert.equal(data.data.finance.pending, 1);
    assert.equal(data.data.leads.upcoming_test_drives, 0, 'the test drive was marked qualified');
    assert.ok(data.data.recentLeads.length >= 1);
  });

  test('unknown API routes return JSON 404s', async () => {
    const { status, data } = await call('/nope');
    assert.equal(status, 404);
    assert.match(data.error, /Not found/);
  });
});
