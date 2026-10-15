import { Router } from 'express';
import { query } from '../db/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Numbers for the admin dashboard overview
router.get('/', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  const [inventory, leads, finance, sourcing, recentLeads] = await Promise.all([
    query(`
      SELECT
        count(*) FILTER (WHERE status = 'available')::int AS available,
        count(*) FILTER (WHERE status = 'reserved')::int  AS reserved,
        count(*) FILTER (WHERE status = 'sold')::int      AS sold,
        coalesce(sum(price) FILTER (WHERE status <> 'sold'), 0) AS stock_value
      FROM vehicles`),
    query(`
      SELECT
        count(*) FILTER (WHERE status = 'new')::int AS new,
        count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last_30_days,
        count(*) FILTER (WHERE type = 'test_drive' AND status IN ('new', 'contacted')
                           AND preferred_date >= current_date)::int AS upcoming_test_drives
      FROM leads`),
    query(`
      SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending
      FROM finance_applications`),
    query(`
      SELECT
        count(*) FILTER (WHERE status = 'new')::int AS new,
        count(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled'))::int AS open
      FROM sourcing_requests`),
    query(`
      SELECT l.id, l.type, l.name, l.status, l.created_at,
             v.year || ' ' || v.make || ' ' || v.model AS vehicle_title
      FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id
      ORDER BY l.created_at DESC LIMIT 5`),
  ]);

  res.json({
    data: {
      inventory: { ...inventory.rows[0], stock_value: Number(inventory.rows[0].stock_value) },
      leads: leads.rows[0],
      finance: finance.rows[0],
      sourcing: sourcing.rows[0],
      recentLeads: recentLeads.rows,
    },
  });
});

export default router;
